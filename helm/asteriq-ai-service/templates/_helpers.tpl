{{- define "asteriq-ai-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "asteriq-ai-service.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "asteriq-ai-service.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- define "asteriq-ai-service.selectorLabels" -}}
app.kubernetes.io/name: ai-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: asteriq
{{- end -}}
{{- define "asteriq-ai-service.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" | quote }}
{{ include "asteriq-ai-service.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "asteriq-ai-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "asteriq-ai-service.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
{{- define "asteriq-ai-service.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}
