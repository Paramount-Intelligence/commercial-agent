import localFont from 'next/font/local';
import './globals.css';

// Montserrat (SIL OFL 1.1, app/fonts/montserrat/OFL.txt), bundled so builds
// do not depend on fetching Google Fonts. Latin subset, variable weight; the
// app uses 300–900.
const montserrat = localFont({
  src: './fonts/montserrat/montserrat-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
});

export const metadata = {
  title: 'Paramount Intelligence — Jackie',
  description: "Chat with Jackie, Paramount Intelligence's AI agent.",
  icons: {
    icon: '/images/logo.png',
    apple: '/images/logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={montserrat.className}>{children}</body>
    </html>
  );
}
