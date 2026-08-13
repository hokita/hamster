import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { auth } from './firebase'
import LoginPage from './pages/LoginPage'
import BookmarksPage from './pages/BookmarksPage'
import BookmarkPage from './pages/BookmarkPage'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, setUser)
  }, [])

  if (user === undefined) return null
  if (!user) return <LoginPage />
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BookmarksPage />} />
        <Route path="/bookmarks/:id" element={<BookmarkPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
