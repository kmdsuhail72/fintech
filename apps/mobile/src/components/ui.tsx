import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, errorMessage } from '../theme/tokens';
export function Screen({
  title,
  subtitle,
  children,
  refreshing = false,
  onRefresh,
  fullScreen = false,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  fullScreen?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={fullScreen ? ['top', 'bottom'] : ['bottom']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            ) : undefined
          }
        >
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.muted}>{subtitle}</Text>}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}
export function Copy({
  children,
  positive,
  negative,
}: {
  children: ReactNode;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <Text
      style={[
        styles.copy,
        positive && { color: colors.positive },
        negative && { color: colors.negative },
      ]}
    >
      {children}
    </Text>
  );
}
export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <View style={styles.metric}>
      <Label>{label}</Label>
      <Text style={[styles.value, tone && { color: colors[tone] }]}>{value}</Text>
    </View>
  );
}
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  danger = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        danger && { backgroundColor: colors.negative },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={styles.buttonText}>{title}</Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        style={styles.input}
        {...props}
      />
    </View>
  );
}
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <View style={styles.error} accessibilityLiveRegion="polite">
      <Copy negative>{errorMessage(error)}</Copy>
      {onRetry && <Button title="Retry" secondary onPress={onRetry} />}
    </View>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <View style={styles.notice}>
      <Text accessibilityLiveRegion="polite" style={styles.copy}>
        {children}
      </Text>
    </View>
  );
}
export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Copy>{text}</Copy>
    </View>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.accent} />
      <Copy>{label}</Copy>
    </View>
  );
}
export function Row({
  title,
  subtitle,
  value,
  onPress,
  children,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const content = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle && <Text style={styles.muted}>{subtitle}</Text>}
        {children}
      </View>
      {value && <Text style={styles.rowValue}>{value}</Text>}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.row}>{content}</View>
  );
}
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  labels?: Partial<Record<T, string>>;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segments}>
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option }}
          onPress={() => onChange(option)}
          style={[styles.segment, value === option && styles.segmentSelected]}
        >
          <Text style={[styles.label, value === option && { color: colors.text }]}>
            {labels?.[option] ?? option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, paddingBottom: 36 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  metric: { gap: 6 },
  value: { color: colors.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  secondary: { backgroundColor: colors.raised },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  field: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    padding: 14,
    backgroundColor: colors.background,
    fontSize: 16,
  },
  error: {
    borderColor: '#663d4c',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    backgroundColor: '#2b1d2a',
  },
  notice: { borderRadius: 12, padding: 14, backgroundColor: colors.raised },
  empty: { alignItems: 'center', padding: 28, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  segments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  segment: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  segmentSelected: { backgroundColor: colors.raised },
});
