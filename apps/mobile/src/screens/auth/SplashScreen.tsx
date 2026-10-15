import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';
export function SplashScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <Text style={styles.glyph}>A</Text>
      </View>
      <Text style={styles.brand}>ASTERIQ AI</Text>
      <Text style={styles.subtitle}>Build your market confidence.</Text>
      <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: 76,
    height: 76,
    backgroundColor: colors.accent,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  glyph: { color: colors.text, fontSize: 44, fontWeight: '800' },
  brand: { color: colors.text, fontSize: 26, letterSpacing: 3, fontWeight: '700' },
  subtitle: { color: colors.muted, marginTop: 12 },
});
