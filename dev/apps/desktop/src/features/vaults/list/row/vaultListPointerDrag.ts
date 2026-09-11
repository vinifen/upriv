export interface VaultListPointerDragHandlers {
  onStart: (key: string, clientX: number, clientY: number) => void;
  onMove: (clientX: number, clientY: number) => void;
  onEnd: (clientX: number, clientY: number) => void;
  onCancel: () => void;
}
