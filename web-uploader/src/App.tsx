import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { UploadQueueProvider } from './context/UploadQueueContext';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <UploadQueueProvider>
        <RouterProvider router={router} />
      </UploadQueueProvider>
    </AuthProvider>
  );
};

export default App;
