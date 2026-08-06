"""Auto-start the Kokoro TTS server (Kokoro-FastAPI) as a Docker container when the backend boots, so voice replies work without a separate manual step."""
import shutil
import socket
import subprocess
from urllib.parse import urlparse

from config import settings


def _host_port() -> tuple[str, int]:
    parsed = urlparse(settings.kokoro_base_url)
    host = parsed.hostname or "localhost"
    if host == "kokoro":
        host = "localhost"
    return host, (parsed.port or 8880)


def _is_up(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _docker(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def ensure_kokoro_running() -> None:
    if not settings.kokoro_autostart:
        return

    host, port = _host_port()
    if _is_up(host, port):
        print(f"[kokoro] already reachable on {host}:{port}")
        return

    if shutil.which("docker") is None:
        print("[kokoro] docker not found on PATH — TTS audio disabled")
        return

    name = settings.kokoro_container_name
    image = settings.kokoro_docker_image

    try:
        ping = _docker("ps", "-q", timeout=15)
        if ping.returncode != 0:
            print(f"[kokoro] docker not available: {ping.stderr.strip()} — TTS audio disabled")
            return

        existing = _docker("ps", "-aq", "-f", f"name=^{name}$", timeout=15).stdout.strip()
        if existing:
            _docker("start", name, timeout=60)
            print(f"[kokoro] started existing container '{name}' on port {port}")
        else:
            run = _docker(
                "run", "-d", "--name", name,
                "-p", f"{port}:8880", image,
                timeout=900,
            )
            if run.returncode == 0:
                print(f"[kokoro] launched '{name}' from {image} on port {port}")
            else:
                print(f"[kokoro] failed to launch: {run.stderr.strip()}")
    except subprocess.TimeoutExpired:
        print("[kokoro] docker command timed out (image may still be pulling)")
    except Exception as e:
        print(f"[kokoro] auto-start error: {e}")
