import React from 'react';
import { Outlet } from 'react-router-dom';
import { DesktopSidebar } from './DesktopSidebar';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { GlobalDropOverlay } from '../uploader/GlobalDropOverlay';
import { FloatingUploadWidget } from '../uploader/FloatingUploadWidget';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-tv-bg text-tv-textLight flex flex-col md:flex-row relative">
      {/* Full screen Drag & Drop Ingestion Overlay */}
      <GlobalDropOverlay />

      {/* Desktop Left Sidebar */}
      <div className="hidden md:block">
        <DesktopSidebar />
      </div>

      {/* Mobile Top Header */}
      <MobileHeader />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 pb-24 md:pb-8 overflow-y-auto">
        <Outlet />
      </main>

      {/* Floating Upload Queue Drawer / Widget */}
      <FloatingUploadWidget />

      {/* Mobile Fixed Bottom Navigation */}
      <MobileBottomNav />
    </div>
  );
};
