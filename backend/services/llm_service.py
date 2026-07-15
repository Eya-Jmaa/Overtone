from openai import OpenAI
from config import settings

client = OpenAI(
    api_key=settings.llm_api_key,
    base_url="https://tokenfactory.esprit.tn/api",
    # Without a timeout, a slow/unresponsive gateway hangs this call
    # indefinitely. Since callers flush the user message to the DB (opening a
    # real SQLite write transaction) before this call, an unbounded hang here
    # holds SQLite's single writer lock forever, causing every other write
    # (creating/deleting a conversation) to fail with "database is locked" -
    # and even blocks a clean server shutdown, since the blocking call runs in
    # a worker thread that can't be cancelled from outside.
    timeout=30.0,
    max_retries=1,
)

MODEL = "hosted_vllm/Llama-3.1-70B-Instruct"
CONTEXT_WINDOW = 20

SYSTEM_PROMPTS = {
    "psy": """You are an empathetic psychology coach helping users develop emotional
intelligence, self-awareness, and healthier relationships. Ask reflective questions,
validate feelings, and guide users toward their own insights. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",

    "professional": """You are a sharp professional coach specializing in career growth,
workplace dynamics, negotiation, and job interviews. Be direct, practical, and
results-oriented. Give concrete advice and frameworks. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",

    "sport": """You are a sport performance coach focused on mindset, motivation,
pre-competition focus, and mental resilience. Use motivational language grounded in
sports psychology. Be energetic but structured. Keep responses concise
(2-4 sentences) unless the user asks for more detail.""",
}


def get_coach_response(mode: str, history: list[dict], user_message: str) -> str:
    """
    Synchronous — OpenAI SDK handles the HTTP call.
    history: list of {"role": "user"|"assistant", "content": str}
    """
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["professional"])

    messages = (
        [{"role": "system", "content": system_prompt}]
        + history[-CONTEXT_WINDOW:]
        + [{"role": "user", "content": user_message}]
    )

    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.7,
        max_tokens=512,
        top_p=0.9,
        frequency_penalty=0.0,
        presence_penalty=0.0,
    )

    return response.choices[0].message.content


def get_coach_response_stream(mode: str, history: list[dict], user_message: str):
    """
    Streaming variant for WebSocket live responses.
    Yields text deltas as they arrive from the LLM.

    history: list of {"role": "user"|"assistant", "content": str}
    Yields: str (text chunks)
    """
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["professional"])

    messages = (
        [{"role": "system", "content": system_prompt}]
        + history[-CONTEXT_WINDOW:]
        + [{"role": "user", "content": user_message}]
    )

    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.7,
        max_tokens=512,
        top_p=0.9,
        frequency_penalty=0.0,
        presence_penalty=0.0,
        stream=True,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def generate_title(user_msg: str, assistant_reply: str) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": (
                "Give a short title (3–5 words, no quotes, no period) for this coaching conversation:\n"
                f"User: {user_msg[:300]}\n"
                f"Coach: {assistant_reply[:300]}"
            ),
        }],
        max_tokens=15,
        temperature=0.4,
    )
    return response.choices[0].message.content.strip().strip("\"'")
