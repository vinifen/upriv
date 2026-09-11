import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Icon } from "@/components/icons/Icon";
import { useTranslation } from "@/i18n";
import { IconButton } from "./IconButton";

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
  inputClassName?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ wrapperClassName = "", inputClassName = "", className, ...props }, ref) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);

    return (
      <div className={["relative w-full", wrapperClassName].filter(Boolean).join(" ")}>
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={[inputClassName, className, "pr-10"].filter(Boolean).join(" ")}
        />
        <IconButton
          type="button"
          label={visible ? t("action.hide_password") : t("action.show_password")}
          variant="ghost"
          size="sm"
          className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? "eye-off" : "eye"} size={18} />
        </IconButton>
      </div>
    );
  },
);
