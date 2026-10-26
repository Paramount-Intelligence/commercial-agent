import Image from 'next/image';
import { cn } from '@/lib/utils';

type Props = {
  size?: number;
  className?: string;
  priority?: boolean;
};

/** The official Paramount mark, shared by every buyer-facing surface. */
export default function ParamountLogo({ size = 36, className, priority = false }: Props) {
  return (
    <Image
      src="/images/logo.png"
      width={size}
      height={size}
      alt="Paramount Intelligence"
      priority={priority}
      className={cn('paramount-logo object-contain', className)}
    />
  );
}
