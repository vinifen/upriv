import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { TextInput } from "react-native";
import { ThemedInput } from "@/components/settings/settingsFields";

type LongTextInputProps = Omit<
  ComponentPropsWithoutRef<typeof ThemedInput>,
  "value" | "defaultValue" | "children"
> & { value: string };

/**
 * A `ThemedInput` for text that can take thousands of keys in one mount. The
 * text goes in as the child, not `value`: on Android a value prop keeps every
 * earlier revision of the input's native state alive, and dropping that chain
 * after a long edit overflows the native stack (react-native#58020). A child's
 * text does not hold the state.
 */
export const LongTextInput = forwardRef<TextInput, LongTextInputProps>(function LongTextInput(
  { value, ...rest },
  ref,
) {
  return (
    <ThemedInput ref={ref} {...rest}>
      {value}
    </ThemedInput>
  );
});
