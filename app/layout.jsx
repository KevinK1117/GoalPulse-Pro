
import './style.css';

export const metadata = {
  title: 'GoalPulse Pro',
  description:
    'Torschützenanalysen für NHL, DEL und Fußball',
  applicationName: 'GoalPulse Pro',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'GoalPulse Pro',
    statusBarStyle: 'default'
  },
  icons: {
    icon: '/icon-512.png',
    apple: '/apple-touch-icon.png'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff'
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
