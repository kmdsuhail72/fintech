# Asteriq AI k6 profiles

See [load-test design and runbook](../../docs/load-testing.md).

`mixed.js` defaults to smoke and supports baseline/capacity. `socketio.js` handles
the application's Socket.IO wire protocol. Copy the dataset schema to a private
file populated with synthetic identities and rotating sessions; example values
are placeholders. k6, staging fixtures/provider stubs, and metrics output need
setup before execution. No load test has been run.
