/**
 * Модальный слой на нативном `<dialog>` (§5.5, §5.7, §7).
 *
 * Своя обёртка вместо kinu Drawer: нужен предсказуемый bottom-sheet
 * на всех ширинах и фокус-трап браузера из коробки. `showModal()` даёт
 * и подложку, и закрытие по Esc, и inert-фон — без единой зависимости.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { cx } from '../ui/kit';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  variant?: 'sheet' | 'full';
  children: ComponentChildren;
};

export function Modal({ open, onClose, label, variant = 'sheet', children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc и кнопка «назад» в жесте браузера закрывают нативно — сообщаем наверх.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: клавиатура покрыта: Esc даёт нативный `cancel`, обработчик ловит только клик по подложке.
    <dialog
      ref={ref}
      class={cx('modal', variant === 'full' && 'modal--full')}
      aria-label={label}
      onClick={(event) => {
        // Клик по подложке: цель — сам dialog, а не его содержимое.
        if (event.target === ref.current) onClose();
      }}
    >
      <div class="modal__panel">{children}</div>
    </dialog>
  );
}
