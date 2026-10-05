import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

afterEach(cleanup);

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(onValueChange = vi.fn(), value = 'a') {
  render(
    <>
      <h3 id="seg-label">Pick</h3>
      <SegmentedControl
        value={value}
        onValueChange={onValueChange}
        options={options}
        aria-labelledby="seg-label"
      />
    </>,
  );
  return { onValueChange, user: userEvent.setup() };
}

it('renders a labelled radiogroup with the selected option checked', () => {
  setup();
  expect(screen.getByRole('radiogroup', { name: 'Pick' })).toBeTruthy();
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('radio', { name: 'Beta' }).getAttribute('aria-checked')).toBe('false');
});

it('calls onValueChange when an option is clicked', async () => {
  const { onValueChange, user } = setup();
  await user.click(screen.getByText('Beta'));
  expect(onValueChange).toHaveBeenCalledWith('b');
});

it('moves selection with the arrow keys', async () => {
  const { onValueChange, user } = setup();
  await user.tab();
  await user.keyboard('{ArrowRight>}');
  // Radix selects on the next frame while the arrow key is still held.
  await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('b'));
  await user.keyboard('{/ArrowRight}');
});

it('keeps a 44px minimum touch target on coarse pointers for both sizes', () => {
  render(
    <>
      <SegmentedControl value="a" onValueChange={vi.fn()} options={options} aria-labelledby="x" />
      <SegmentedControl
        size="sm"
        value="a"
        onValueChange={vi.fn()}
        options={[{ value: 's', label: 'Small' }]}
        aria-labelledby="y"
      />
    </>,
  );
  expect(screen.getByText('Alpha').closest('label')?.className).toContain(
    'pointer-coarse:min-h-11',
  );
  expect(screen.getByText('Small').closest('label')?.className).toContain(
    'pointer-coarse:min-h-11',
  );
});
