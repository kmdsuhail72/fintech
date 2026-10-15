import { useState } from 'react';
import { Modal } from 'react-native';
import { Button, Card, EmptyState, Field, Row, Screen } from './ui';
import type { Instrument } from '../services/types';
export function SymbolPicker({
  instruments,
  selected,
  onSelect,
}: {
  instruments: Instrument[];
  selected: Instrument | undefined;
  onSelect: (instrument: Instrument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rows = instruments.filter((item) =>
    (item.symbol + ' ' + item.company_name).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Button
        secondary
        title={
          selected ? selected.symbol + ' · ' + selected.company_name : 'Select a market symbol'
        }
        onPress={() => setOpen(true)}
      />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen fullScreen title="Choose a symbol">
          <Field
            label="Search symbols"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          <Card>
            {rows.map((item) => (
              <Row
                key={item.id}
                title={item.symbol}
                subtitle={item.company_name}
                onPress={() => {
                  onSelect(item);
                  setOpen(false);
                  setSearch('');
                }}
              />
            ))}
            {!rows.length && <EmptyState text="No matching symbols are loaded." />}
          </Card>
          <Button title="Close" secondary onPress={() => setOpen(false)} />
        </Screen>
      </Modal>
    </>
  );
}
