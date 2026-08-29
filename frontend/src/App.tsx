import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./hooks/AuthProvider";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";

import { LoginPage } from "./pages/LoginPage";
import { JournalPage } from "./pages/JournalPage";
import { EntryEditorPage } from "./pages/EntryEditorPage";
import { MoodPage } from "./pages/MoodPage";
import { SettingsPage } from "./pages/SettingsPage";

import { PrivateChatPage } from "./pages/PrivateChatPage";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/journal"
            element={
              <ProtectedRoute>
                <Layout>
                  <JournalPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/journal/new"
            element={
              <ProtectedRoute>
                <Layout>
                  <EntryEditorPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/journal/:id"
            element={
              <ProtectedRoute>
                <Layout>
                  <EntryEditorPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/mood"
            element={
              <ProtectedRoute>
                <Layout>
                  <MoodPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <SettingsPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/private/:sessionId"
            element={
              <ProtectedRoute>
                <PrivateChatPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="*"
            element={<Navigate to="/journal" replace />}
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}