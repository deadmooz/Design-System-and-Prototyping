// Optional React bindings for the generic component layer (src/styles/components.css).
// Theme them with the CSS variables emitted for any design system:
//   import 'design-system-prototyping/components.css';
//   <style>{toCssVariables(designSystem)}</style>
export { Button } from './components/Button/Button.tsx';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button/Button.tsx';
export { Input } from './components/Input/Input.tsx';
export type { InputProps } from './components/Input/Input.tsx';
export { Badge } from './components/Badge/Badge.tsx';
export type { BadgeProps, BadgeVariant } from './components/Badge/Badge.tsx';
export { Card } from './components/Card/Card.tsx';
export type { CardProps, CardVariant } from './components/Card/Card.tsx';
export { Avatar } from './components/Avatar/Avatar.tsx';
export type { AvatarProps, AvatarSize } from './components/Avatar/Avatar.tsx';
export { Spinner } from './components/Spinner/Spinner.tsx';
export type { SpinnerProps } from './components/Spinner/Spinner.tsx';
export { Checkbox } from './components/Checkbox/Checkbox.tsx';
export type { CheckboxProps } from './components/Checkbox/Checkbox.tsx';
export { Modal } from './components/Modal/Modal.tsx';
export type { ModalProps, ModalVariant } from './components/Modal/Modal.tsx';
