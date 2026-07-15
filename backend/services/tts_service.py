"""
Text-to-Speech service using Kokoro-82M via Kokoro-FastAPI.

This module provides a clean seam so the TTS engine is swappable later
(cloud fallback, different model) by changing one file.
"""
import re
import asyncio
from typing import Optional, AsyncGenerator
from openai import AsyncOpenAI
from config import settings


# Abbreviations to NOT treat as sentence endings
ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "e.g", "i.e", "vs.",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
}

# Regex patterns for text cleaning
MARKDOWN_PATTERN = re.compile(r'(\*\*|__|\*|_|`|#)')
HEADER_PATTERN = re.compile(r'^#{1,6}\s+', re.MULTILINE)
CODE_BLOCK_PATTERN = re.compile(r'```.*?```', re.DOTALL)
EMOJI_PATTERN = re.compile(
    "["  # Emoji ranges
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map symbols
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"  # dingbats
    "\U000024C2-\U0001F251"  # enclosed characters
    "]+",
    flags=re.UNICODE,
)


def clean_for_tts(text: str) -> str:
    """
    Clean text for natural-sounding TTS playback.
    
    Strips markdown, emojis, code blocks, and converts common patterns
    to spoken form. This is critical for naturalness - dirty input is
    most of what sounds robotic.
    """
    if not text:
        return ""
    
    # Remove code blocks (they sound terrible in speech)
    text = CODE_BLOCK_PATTERN.sub("", text)
    
    # Remove markdown formatting
    text = MARKDOWN_PATTERN.sub("", text)
    
    # Remove headers
    text = HEADER_PATTERN.sub("", text)
    
    # Remove emojis
    text = EMOJI_PATTERN.sub("", text)
    
    # Convert number/range patterns to spoken form
    # "2-4" → "two to four"
    text = re.sub(r'(\d+)-(\d+)', lambda m: f"{num_to_words(m.group(1))} to {num_to_words(m.group(2))}", text)
    
    # "3:15" → "three fifteen" (timestamp-like)
    text = re.sub(r'(\d{1,2}):(\d{2})(?!\s*[AP]M)', lambda m: f"{num_to_words(m.group(1))} {num_to_words(m.group(2))}", text)
    
    # Expand common abbreviations
    abbrev_map = {
        "e.g.": "for example",
        "i.e.": "that is",
        "etc.": "and so on",
    }
    for abbrev, expansion in abbrev_map.items():
        text = text.replace(abbrev, expansion)
    
    # Clean up extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text


def num_to_words(n: str) -> str:
    """Convert a number string to words (simple implementation for TTS)."""
    try:
        num = int(n)
        # Only handle small numbers common in coaching context
        ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
        tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
        
        if num == 0:
            return "zero"
        elif num < 20:
            return ones[num]
        elif num < 100:
            return f"{tens[num // 10]} {ones[num % 10]}".strip()
        elif num < 1000:
            return f"{ones[num // 100]} hundred"
        else:
            return str(num)
    except ValueError:
        return n


# Kokoro client using OpenAI-compatible API
_kokoro_client: Optional[AsyncOpenAI] = None


def get_kokoro_client() -> AsyncOpenAI:
    """Get or create the Kokoro OpenAI-compatible client."""
    global _kokoro_client
    if _kokoro_client is None:
        _kokoro_client = AsyncOpenAI(
            api_key="not-used",  # Kokoro doesn't require auth
            base_url=settings.kokoro_base_url,
            timeout=settings.kokoro_timeout_seconds,
        )
    return _kokoro_client


async def tts_synthesize(text: str) -> Optional[bytes]:
    """
    Synthesize text to speech using Kokoro service.
    
    Args:
        text: The text to synthesize (will be cleaned for TTS)
        
    Returns:
        Audio bytes in the configured format (MP3), or None if TTS fails.
    """
    cleaned = clean_for_tts(text)
    if not cleaned:
        return None
    
    client = get_kokoro_client()
    
    try:
        response = await client.audio.speech.create(
            model="kokoro",
            voice=settings.kokoro_voice,
            input=cleaned,
            response_format=settings.kokoro_response_format,
        )
        return response.read()
    except asyncio.TimeoutError:
        print(f"TTS timeout for text: {cleaned[:50]}...")
        return None
    except Exception as e:
        print(f"TTS error: {e}")
        return None


async def sentences_from_deltas(deltas: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    """
    Aggregate LLM deltas into complete sentences.
    
    Prosody dies if you synthesize word-by-word, so we buffer deltas
    and yield complete sentences on sentence-ending punctuation.
    
    Handles false-trigger cases: periods inside abbreviations ("Dr.", "e.g.")
    and decimals ("2.5") will otherwise split mid-sentence.
    
    At the end, flushes any remaining buffer (tail-flush).
    """
    buffer = ""
    
    async for delta in deltas:
        buffer += delta
        
        # Find all sentence-ending punctuation positions
        matches = list(re.finditer(r'[.!?]+', buffer))
        
        # Process matches in order (skip potential false triggers)
        new_buffer_start = 0
        for match in matches:
            sentence_end = match.end()
            sentence = buffer[:sentence_end].strip()
            
            # Skip false triggers
            if _is_false_trigger(buffer, match):
                continue
            
            if sentence:
                yield sentence
                new_buffer_start = sentence_end
            else:
                break
        
        if new_buffer_start > 0:
            buffer = buffer[new_buffer_start:]
    
    # Tail flush: yield any remaining text
    if buffer.strip():
        yield buffer.strip()


def _is_false_trigger(buffer: str, match: re.Match) -> bool:
    """Check if a period match is likely a false trigger (abbreviation or decimal)."""
    pos = match.start()
    
    # Check for decimal pattern (digit.digit)
    if (pos > 0 and pos < len(buffer) - 1 and 
        buffer[pos - 1].isdigit() and buffer[pos + 1].isdigit()):
        return True
    
    # Check for common abbreviations
    for abbrev in ABBREVIATIONS:
        abbrev_pattern = f"(?:\\s|^){abbrev}\\.?$"
        if re.search(abbrev_pattern, buffer[:match.end()], re.IGNORECASE):
            return True
            
    return False