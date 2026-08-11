import { useState } from 'react'
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import { auth } from '../firebase'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    try {
      if (import.meta.env.VITE_E2E === 'true') {
        await signInWithEmailAndPassword(
          auth,
          import.meta.env.VITE_E2E_TEST_EMAIL,
          import.meta.env.VITE_E2E_TEST_PASSWORD
        )
      } else {
        const provider = new GoogleAuthProvider()
        await signInWithPopup(auth, provider)
      }
      setError(null)
    } catch {
      setError('Sign-in failed.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-gray-50 gap-6">
      <div className="flex flex-col items-center gap-4 bg-white border border-gray-200 rounded-lg shadow-sm px-10 py-8">
        <h1 className="text-2xl font-bold m-0">hamster</h1>
        <p className="text-sm text-gray-500 m-0">Your bookmarks, all in one place</p>
        <button
          onClick={handleSignIn}
          className="flex items-center gap-2 px-6 py-3 text-base cursor-pointer rounded-md border border-gray-300 hover:bg-gray-50 active:bg-gray-100"
        >
          <FontAwesomeIcon icon={faGoogle} aria-hidden="true" />
          Sign in with Google
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>
    </div>
  )
}
