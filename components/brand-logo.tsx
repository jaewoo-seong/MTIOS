import Image from "next/image";

type BrandLogoProps = {
  alt?: string;
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ alt = "MTI Korea", className = "", priority = false }: BrandLogoProps) {
  const classes = ["brand-logo-image", className].filter(Boolean).join(" ");

  return (
    <Image
      className={classes}
      src="/brand/mti-mark.png"
      width={759}
      height={353}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      priority={priority}
    />
  );
}
