"""Run the backend and website on one origin: python -m backend"""
import os

import uvicorn


def main():
    host = os.environ.get("EPIMETRICS_HOST", "127.0.0.1")
    port = int(os.environ.get("EPIMETRICS_PORT", "8000"))
    uvicorn.run("backend.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
