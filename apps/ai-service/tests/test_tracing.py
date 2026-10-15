from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from app import tracing
from app.observability import ObservabilityMiddleware, observe_provider


def test_node_parent_fastapi_llm_http_and_privacy_share_trace():
    exporter = InMemorySpanExporter()
    app = FastAPI()
    app.add_middleware(ObservabilityMiddleware)
    captured = []
    captured_state = []
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length', 0)))
            captured.append(self.headers.get('traceparent'))
            captured_state.append(self.headers.get('tracestate'))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        def log_message(self, *args):
            pass
    llm = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = Thread(target=llm.serve_forever, daemon=True)
    worker.start()

    @observe_provider
    async def generate():
        active = trace.get_current_span()
        active.set_attribute('db.statement', 'SELECT private_financial_value')
        active.set_attribute('db.operation.name', 'SELECT private_financial_value')
        active.add_event('exception', {'exception.message': 'private-prompt'})
        async with httpx.AsyncClient() as client:
            await client.post(f'http://127.0.0.1:{llm.server_port}/v1/responses', json={'input': 'private-prompt'}, headers={'Authorization': 'Bearer private-key'})

    @app.get('/research/test')
    async def endpoint():
        await generate()
        return {'trace_id': f'{trace.get_current_span().get_span_context().trace_id:032x}'}

    tracing.configure_tracing(app, exporter)
    trace_id = 'a' * 32
    try:
        with TestClient(app) as client:
            result = client.get('/research/test', headers={
                'traceparent': f'00-{trace_id}-' + 'b' * 16 + '-01',
                'tracestate': 'asteriq=test'})
    finally:
        llm.shutdown()
        llm.server_close()
        worker.join(timeout=5)
    assert result.status_code == 200
    assert result.json()['trace_id'] == trace_id
    assert result.headers['X-Trace-Id'] == trace_id
    tracing.provider.force_flush()
    spans = exporter.get_finished_spans()
    assert {'http.server', 'llm.request', 'http.client'} <= {span.name for span in spans}
    assert all(f'{span.context.trace_id:032x}' == trace_id for span in spans)
    assert all(not span.events for span in spans)
    assert 'private-' not in str([dict(span.attributes) for span in spans])
    assert 'private_financial_value' not in str([dict(span.attributes) for span in spans])
    assert any(span.attributes.get('server.address') == '127.0.0.1' for span in spans)
    assert captured[0].split('-')[1] == trace_id
    assert captured_state == ['asteriq=test']
    server = next(span for span in spans if span.name == 'http.server')
    llm_span = next(span for span in spans if span.name == 'llm.request')
    http_span = next(span for span in spans if span.name == 'http.client')
    assert server.parent.span_id == int('b' * 16, 16)
    assert llm_span.parent.span_id == server.context.span_id
    assert http_span.parent.span_id == llm_span.context.span_id
    assert captured[0].split('-')[2] == f'{http_span.context.span_id:016x}'
