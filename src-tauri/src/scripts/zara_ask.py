# One message to Zara, for Harness' chat panel. Runs on the Pi inside her repo
# (cwd /mnt/phone_files/files, .agent_env loaded, her venv's python), the same
# way zara_cli.py talks to her: in-process gateway, Sahil's chat id, so the
# turn continues the Telegram conversation. Prints JSON lines:
#   {"type":"text","text":...}  a streamed chunk
#   {"type":"tool"}             she started using tools
#   {"type":"result","text":...,"tools":[...],"duration_ms":...}
#   {"type":"error","text":...}
# MESSAGE (base64) is prepended by Harness.
import asyncio, base64, json, os, sys, time

sys.path.insert(0, os.environ.get("ZARA_REPO", "/mnt/phone_files/files"))
CHAT_ID = int(os.environ.get("ZARA_CLI_CHAT_ID", "7764829414"))


def emit(**event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


async def main():
    text = base64.b64decode(MESSAGE).decode("utf-8")  # noqa: F821 (prepended)
    t0 = time.perf_counter()
    try:
        from gateway.gateway import Gateway, GatewayConfig
        from core.system_prompt import build_system_prompt
        gw = await Gateway.from_config_async(GatewayConfig(persona=build_system_prompt))
    except Exception as e:  # noqa: BLE001
        emit(type="error", text=f"couldn't start Zara: {type(e).__name__}: {e}")
        return 1
    emit(type="init", model=str(getattr(gw.config, "model", "")))

    async def on_token(chunk):
        if chunk is None:
            emit(type="tool")
        else:
            emit(type="text", text=chunk)

    try:
        res = await gw.handle_user_message(CHAT_ID, text, on_token=on_token)
    except Exception as e:  # noqa: BLE001
        emit(type="error", text=f"{type(e).__name__}: {e}")
        return 1
    reply = getattr(res, "reply", None) or getattr(res, "assistant_text", "") or ""
    tools = [tc.get("name") for tc in (getattr(res, "tool_calls", None) or []) if isinstance(tc, dict)]
    emit(type="result", text=reply, tools=tools, duration_ms=int((time.perf_counter() - t0) * 1000))
    return 0


sys.exit(asyncio.run(main()))
