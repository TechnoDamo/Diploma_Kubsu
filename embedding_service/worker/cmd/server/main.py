"""Main entry point for the embedding worker."""
import asyncio
import uvloop

# Use uvloop for better performance
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

from worker.api.grpc_server import serve

if __name__ == "__main__":
    serve()