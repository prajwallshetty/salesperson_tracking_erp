import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { SocketProvider } from '@/context/SocketContext';

export const metadata = {
  title: 'Field Sales & GPS Tracking ERP',
  description: 'Enterprise Salesperson Tracking, Attendance, Order Taking & Payment Collection Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F5F7F8] text-[#0B1320] antialiased min-h-screen">
        <AuthProvider>
          <SocketProvider>{children}</SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
