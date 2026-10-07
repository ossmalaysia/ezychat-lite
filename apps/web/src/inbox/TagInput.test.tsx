import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TagInput } from './TagInput';

function Harness({ initial = [] as string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <TagInput value={tags} onChange={setTags} suggestions={['VIP', 'Wholesale', 'Halal']} />
      <output data-testid="tags">{tags.join('|')}</output>
    </>
  );
}

afterEach(cleanup);

describe('TagInput', () => {
  it('adds on Enter and comma, ignores case duplicates, removes with Backspace', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'VIP{Enter}wholesale,vip{Enter}');
    expect(screen.getByTestId('tags').textContent).toBe('VIP|wholesale');
    expect((input as HTMLInputElement).value).toBe('');
    await userEvent.type(input, '{Backspace}');
    expect(screen.getByTestId('tags').textContent).toBe('VIP');
  });

  it('normalizes spacing and removes a tag with its button', async () => {
    render(<Harness initial={['VIP']} />);
    await userEvent.type(screen.getByRole('combobox'), '  Halal   catering {Enter}');
    expect(screen.getByTestId('tags').textContent).toBe('VIP|Halal catering');
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag VIP' }));
    expect(screen.getByTestId('tags').textContent).toBe('Halal catering');
  });

  it('suggests unused tags by prefix and adds a clicked suggestion', async () => {
    render(<Harness initial={['VIP']} />);
    await userEvent.type(screen.getByRole('combobox'), 'h');
    expect(screen.queryByRole('option', { name: 'VIP' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Wholesale' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Halal' }));
    expect(screen.getByTestId('tags').textContent).toBe('VIP|Halal');
  });

  it('adds the typed tag with the Add button (no Enter needed on phone keyboards)', async () => {
    render(<Harness initial={['VIP']} />);
    const add = screen.getByRole('button', { name: 'Add tag' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole('combobox'), 'Halal catering');
    expect((add as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(add);
    expect(screen.getByTestId('tags').textContent).toBe('VIP|Halal catering');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
    // 44px touch targets on phones: Add, remove ×, and suggestions.
    expect(add.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    const remove = screen.getByRole('button', { name: 'Remove tag VIP' });
    expect(remove.className).toMatch(/(^|\s)size-6(\s|$)/);
    expect(remove.className).toMatch(/before:-inset-2\.5/);
    await userEvent.type(screen.getByRole('combobox'), 'w');
    expect(screen.getByRole('option', { name: 'Wholesale' }).className).toMatch(
      /(^|\s)min-h-11(\s|$)/,
    );
  });

  it('stops at 10 tags', () => {
    render(<Harness initial={Array.from({ length: 10 }, (_, i) => `t${i}`)} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect((screen.getByRole('button', { name: 'Add tag' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Up to 10 tags');
  });

  it('clears leftover text when a pasted list fills the limit', () => {
    const queries: string[] = [];
    function Limited() {
      const [tags, setTags] = useState(Array.from({ length: 9 }, (_, i) => `t${i}`));
      return (
        <>
          <TagInput value={tags} onChange={setTags} onQueryChange={(q) => queries.push(q)} />
          <output data-testid="tags">{tags.join('|')}</output>
        </>
      );
    }
    render(<Limited />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x,y' } });
    expect(screen.getByTestId('tags').textContent).toBe('t0|t1|t2|t3|t4|t5|t6|t7|t8|x');
    expect(input.value).toBe('');
    expect(queries.at(-1)).toBe('');
  });

  it('ignores Enter while an input method is composing, and caps tags at 30 characters', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '批发' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.getByTestId('tags').textContent).toBe('');
    expect(input.maxLength).toBe(30);
  });
});
