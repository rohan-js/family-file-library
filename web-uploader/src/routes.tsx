import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LibraryView } from './views/LibraryView';
import { FolderView } from './views/FolderView';
import { PairingView } from './views/PairingView';
import { DevicesView } from './views/DevicesView';
import { TrashView } from './views/TrashView';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <LibraryView /> },
      { path: 'folders/:folderId', element: <FolderView /> },
      { path: 'pair', element: <PairingView /> },
      { path: 'devices', element: <DevicesView /> },
      { path: 'trash', element: <TrashView /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
