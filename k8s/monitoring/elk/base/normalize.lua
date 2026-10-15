function normalize(tag, timestamp, record)
  local k = type(record.kubernetes) == 'table' and record.kubernetes or {}
  local app = type(record.application) == 'table' and record.application or {}
  local ns = k.namespace_name or "unknown"
  if not (ns:match('^asteriq%-dev$') or ns:match('^asteriq%-staging$') or ns:match('^asteriq%-production$') or ns == 'kube-system' or ns == 'ingress-nginx' or ns == 'ingress-system' or ns == 'cert-manager' or ns == 'monitoring') then
    return -1, timestamp, record
  end
  local labels = k.labels or {}
  local service = labels['app.kubernetes.io/name'] or k.container_name or 'unknown'
  if service == 'fluent-bit' or service == 'alloy' or service:match('^loki') or service == 'elasticsearch' or service == 'kibana' then return -1, timestamp, record end
  if service == 'frontend' then service = 'web' end
  local environment = ns:match('^asteriq%-(.+)$') or os.getenv('ASTERIQ_ENVIRONMENT') or 'unknown'
  if environment ~= 'dev' and environment ~= 'staging' and environment ~= 'production' then environment = 'unknown' end
  local message = app.message or app.msg or record.log or 'Structured container event'
  if type(message) ~= 'string' then message = 'Structured container event' end
  if not app.message and not app.msg and message:match('^%s*{') then message = 'Structured container event' end
  message = message:gsub('[Bb][Ee][Aa][Rr][Ee][Rr]%s+[^%s"]+', 'Bearer [REDACTED]')
  for _, scheme in ipairs({'postgresql','postgres','redis','rediss','smtp','smtps'}) do
    message = message:gsub(scheme .. '://[^@%s]+@', scheme .. '://[REDACTED]@')
  end
  for _, key in ipairs({'token','code','password','secret','api_key','access_token','refresh_token'}) do
    message = message:gsub('([?&]' .. key .. '=)[^&%s"\\]+', '%1[REDACTED]')
  end
  message = message:gsub('[%w._%%+-]+@[%w.-]+%.[%a]+', '[REDACTED_EMAIL]'):sub(1, 4000)
  local level = tostring(app.level or 'unknown'):lower()
  if level == 'warning' then level = 'warn' end
  if level ~= 'debug' and level ~= 'info' and level ~= 'warn' and level ~= 'error' and level ~= 'fatal' and level ~= 'panic' then
    if message:match('^[EF]%d%d%d%d') or message:match('%[error%]') then level = 'error' else level = 'unknown' end
  end
  local raw_status = app.status_code or app.status
  local status = (type(raw_status) == 'string' or type(raw_status) == 'number') and tonumber(raw_status) or nil
  if status and (status < 100 or status > 599 or status % 1 ~= 0) then status = nil end
  local endpoint = app.endpoint or app.route or ''
  if type(endpoint) ~= 'string' then endpoint = '' end
  local event = app.event or 'container_log'
  if type(event) ~= 'string' then event = 'container_log' end
  local category = 'application'
  if event:match('^authentication_') or event:match('^authorization_') or event == 'security_event' or status == 401 or status == 403 or status == 429 or endpoint:match('/login') or endpoint:match('/register') or endpoint:match('/logout') or endpoint:match('/refresh') then
    category = 'security'
  elseif event == 'trade_failure' or endpoint:match('orders') or endpoint:match('trades') then category = 'trading'
  elseif service == 'ai-service' or event == 'ai_failure' then category = 'ai' end
  local safe_user = app.user_safe_identifier
  if type(safe_user) ~= 'string' or #safe_user ~= 24 or not safe_user:match('^[a-f0-9]+$') then safe_user = '' end
  local result = {
    service=service, environment=environment, namespace=ns, pod=k.pod_name or 'unknown',
    container=k.container_name or 'unknown', node=k.host or 'unknown', level=level,
    message=message, endpoint=endpoint:sub(1,256), event=event:sub(1,128),
    request_id=tostring(app.request_id or app.requestId or ''):sub(1,128),
    trace_id=tostring(app.trace_id or app.traceId or ''):sub(1,128),
    user_safe_identifier=safe_user, category=category,
    es_index_prefix='asteriq-' .. environment .. '-' .. category,
  }
  if status then result.status_code = status end
  return 1, timestamp, result
end
