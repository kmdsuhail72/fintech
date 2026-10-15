import { useEffect, useState } from 'react';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorNotice, Field, Loading, Notice, Screen } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import { api, session } from '../../services/runtime';
import type { Profile } from '../../services/types';
import type { RootParams, TabParams } from '../../navigation/types';
export function ProfileScreen({ navigation }: BottomTabScreenProps<TabParams, 'Profile'>) {
  const profile = useApiQuery<Profile>('profile', '/users/me');
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (profile.data) setName(profile.data.display_name ?? '');
  }, [profile.data]);
  const update = useMutation({
    mutationFn: () =>
      api.request('/users/me', { method: 'PATCH', body: { displayName: name.trim() || null } }),
    onSuccess: async () => {
      setNotice('Profile saved.');
      await client.invalidateQueries({ queryKey: ['profile'] });
    },
  });
  const open = (route: 'Settings' | 'Watchlist' | 'Alerts' | 'AIResearch') =>
    navigation.getParent<NativeStackNavigationProp<RootParams>>()?.navigate(route);
  return (
    <Screen title="Your profile" subtitle="Manage your account and learning workspace.">
      {profile.isLoading && <Loading />}
      <ErrorNotice error={profile.error} onRetry={() => void profile.refetch()} />
      {profile.data && (
        <Card>
          <Field label="Email address" value={profile.data.email} editable={false} />
          <Field label="Display name" value={name} onChangeText={setName} maxLength={100} />
          <Button title="Save profile" busy={update.isPending} onPress={() => update.mutate()} />
          <ErrorNotice error={update.error} />
          {notice && <Notice>{notice}</Notice>}
        </Card>
      )}
      <Card>
        <Button secondary title="Watchlist" onPress={() => open('Watchlist')} />
        <Button secondary title="AI research" onPress={() => open('AIResearch')} />
        <Button secondary title="Price alerts" onPress={() => open('Alerts')} />
        <Button secondary title="Settings & security" onPress={() => open('Settings')} />
        <Button secondary title="Lock app" onPress={() => session.lock()} />
      </Card>
    </Screen>
  );
}
