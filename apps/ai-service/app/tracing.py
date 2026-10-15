"""OpenTelemetry setup with an exporter privacy boundary for automatic spans."""
from contextlib import contextmanager
import os
import re
import importlib.util
from opentelemetry import trace
from opentelemetry.propagate import inject, set_global_textmap
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

provider = None
SAFE_ATTRIBUTES = {'http.method', 'http.request.method', 'http.status_code',
                   'http.response.status_code', 'http.route', 'db.system', 'db.system.name',
                   'db.operation', 'db.operation.name', 'server.address', 'peer.service'}


def safe_attributes(attributes):
    result = {key: value for key, value in (attributes or {}).items() if key in SAFE_ATTRIBUTES}
    for key in ['db.operation', 'db.operation.name']:
        if key in result:
            operation = str(result[key]).split(' ', 1)[0].upper()
            result[key] = operation if operation in {'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'WITH', 'EXECUTE', 'CALL'} else 'QUERY'
    if 'server.address' in result and not re.fullmatch(r'[A-Za-z0-9.:-]{1,253}', str(result['server.address'])):
        result.pop('server.address')
    return result


class PrivacyExporter(SpanExporter):
    def __init__(self, exporter):
        self.exporter = exporter

    def export(self, spans):
        safe = []
        for span in spans:
            scope = getattr(span.instrumentation_scope, 'name', '')
            name = 'postgresql.query' if 'psycopg' in scope else 'http.client' if 'httpx' in scope else 'http.server' if 'fastapi' in scope or 'asgi' in scope else span.name if span.name in {'llm.request', 'ai.embeddings'} else 'operation'
            resource = Resource({key: value for key, value in span.resource.attributes.items()
                                 if key in {'service.name', 'deployment.environment.name'}})
            safe.append(ReadableSpan(name=name, context=span.context, parent=span.parent,
                resource=resource, attributes=safe_attributes(span.attributes), events=[], links=[],
                kind=span.kind, status=trace.Status(span.status.status_code),
                start_time=span.start_time, end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope))
        return self.exporter.export(safe)

    def shutdown(self):
        return self.exporter.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.exporter.force_flush(timeout_millis)


def configure_tracing(app, exporter=None):
    global provider
    if provider is not None or (exporter is None and os.getenv('OTEL_ENABLED') != 'true'):
        return
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    try:
        ratio = max(0, min(1, float(os.getenv('OTEL_TRACE_SAMPLE_RATIO', '0.1'))))
    except ValueError:
        ratio = 0.1
    provider = TracerProvider(resource=Resource.create({'service.name': 'asteriq-ai-service',
        'deployment.environment.name': os.getenv('ASTERIQ_ENVIRONMENT', 'local')}),
        sampler=ParentBased(TraceIdRatioBased(1 if exporter else ratio)))
    provider.add_span_processor(BatchSpanProcessor(PrivacyExporter(exporter or OTLPSpanExporter(timeout=3)),
        max_queue_size=1024, max_export_batch_size=128, schedule_delay_millis=2000, export_timeout_millis=3000))
    trace.set_tracer_provider(provider)
    set_global_textmap(TraceContextTextMapPropagator())
    def request_hook(span, request):
        if span and span.is_recording():
            span.set_attribute('server.address', request.url.host)
    async def async_request_hook(span, request):
        request_hook(span, request)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider, request_hook=request_hook,
                                        async_request_hook=async_request_hook)
    if importlib.util.find_spec('psycopg') is not None:
        from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
        PsycopgInstrumentor().instrument(tracer_provider=provider, enable_commenter=False)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider,
        excluded_urls=r'.*/metrics/?$,.*/health(?:/live|/ready)?$',
        exclude_spans=['send', 'receive'], server_request_hook=lambda span, scope: span.update_name('http.server'))


def current_span_context():
    active = trace.get_current_span().get_span_context()
    return active if active.is_valid else None


def trace_headers():
    headers = {}
    if current_span_context():
        inject(headers)
    return headers


@contextmanager
def operation_span(name):
    if provider is None:
        yield
        return
    with trace.get_tracer('asteriq-ai-service').start_as_current_span(name,
            record_exception=False, set_status_on_exception=False) as span:
        span.set_attribute('peer.service', 'external-llm' if name == 'llm.request' else 'external-embeddings')
        try:
            yield
        except BaseException:
            span.set_status(trace.Status(trace.StatusCode.ERROR))
            raise


def shutdown_tracing():
    if provider is not None:
        provider.shutdown()
