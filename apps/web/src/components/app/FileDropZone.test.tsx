import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileDropZone } from './FileDropZone';

afterEach(() => cleanup());

const files = (list: File[]) => ({
  dataTransfer: { types: ['Files'], files: list, dropEffect: '' },
});

describe('FileDropZone', () => {
  it('shows the overlay while files are over it and hands dropped files on', () => {
    const onFiles = vi.fn();
    render(
      <FileDropZone enabled onFiles={onFiles} aria-label="Chat">
        <p>child</p>
      </FileDropZone>,
    );
    const zone = screen.getByRole('region', { name: 'Chat' });
    const doc = new File(['d'], 'quote.pdf', { type: 'application/pdf' });
    fireEvent.dragEnter(zone, files([doc]));
    fireEvent.dragEnter(screen.getByText('child'), files([doc]));
    expect(screen.getByTestId('file-drop-overlay').textContent).toContain(
      'Drop files to send them in this chat',
    );
    // Leaving a child is not leaving the zone.
    fireEvent.dragLeave(screen.getByText('child'), files([doc]));
    expect(screen.getByTestId('file-drop-overlay')).toBeTruthy();
    const over = files([doc]);
    fireEvent.dragOver(zone, over);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    fireEvent.drop(zone, files([doc]));
    expect(onFiles).toHaveBeenCalledWith([doc]);
    expect(screen.queryByTestId('file-drop-overlay')).toBeNull();
  });

  it('hides the overlay when the drag leaves', () => {
    render(<FileDropZone enabled onFiles={vi.fn()} aria-label="Chat" />);
    const zone = screen.getByRole('region', { name: 'Chat' });
    fireEvent.dragEnter(zone, files([]));
    fireEvent.dragLeave(zone, files([]));
    expect(screen.queryByTestId('file-drop-overlay')).toBeNull();
  });

  it('refuses the drop with a note when sending is not possible', () => {
    const onFiles = vi.fn();
    render(<FileDropZone enabled={false} onFiles={onFiles} aria-label="Chat" />);
    const zone = screen.getByRole('region', { name: 'Chat' });
    fireEvent.dragEnter(zone, files([]));
    expect(screen.getByTestId('file-drop-overlay').textContent).toContain(
      'Files can’t be sent in this chat right now.',
    );
    const over = files([]);
    fireEvent.dragOver(zone, over);
    expect(over.dataTransfer.dropEffect).toBe('none');
    fireEvent.drop(zone, files([new File(['x'], 'x.txt')]));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('ignores text and link drags, and takes custom texts', () => {
    const onFiles = vi.fn();
    const { container } = render(
      <FileDropZone
        as="div"
        enabled
        onFiles={onFiles}
        title="Drop a file here"
        hint="One at a time"
      />,
    );
    const zone = container.firstElementChild as HTMLElement;
    expect(zone.tagName).toBe('DIV');
    const text = { dataTransfer: { types: ['text/plain'], files: [] } };
    fireEvent.dragEnter(zone, text);
    fireEvent.dragOver(zone, text);
    fireEvent.dragLeave(zone, text);
    fireEvent.drop(zone, text);
    expect(screen.queryByTestId('file-drop-overlay')).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
    fireEvent.dragEnter(zone, files([]));
    expect(screen.getByTestId('file-drop-overlay').textContent).toBe(
      'Drop a file hereOne at a time',
    );
  });
});
