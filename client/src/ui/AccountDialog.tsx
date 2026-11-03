import { FormEvent, useState } from 'react'
import Dialog from './Dialog'
import {
  Account, ApiError, MAX_PASSWORD, MIN_PASSWORD, USERNAME_PATTERN,
  changePassword, deleteAccount, login, logout, register,
} from '../account/api'

interface Props {
  account: Account | null
  // This browser's map progress, carried into the account at sign-in.
  localFurthest: number
  onClose: () => void
  onSignedIn: (account: Account) => void
  onSignedOut: () => void
}

type Mode = 'signin' | 'register'

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong.')

// Optional player account: sign in or create an account (guests keep
// playing exactly as before), and, once signed in, sign out, change the
// password, or delete the account.
const AccountDialog = ({ account, localFurthest, onClose, onSignedIn, onSignedOut }: Props) => {
  return (
    <Dialog className="settings-overlay" labelledBy="account-title" onClose={onClose} onBackdropClick={onClose}>
      <div className="settings-box panel account-box" onClick={e => e.stopPropagation()}>
        <div className="settings-title" id="account-title">{account ? 'PILOT ACCOUNT' : 'SIGN IN'}</div>
        {account
          ? <SignedIn account={account} onSignedOut={onSignedOut} />
          : <SignedOut localFurthest={localFurthest} onSignedIn={onSignedIn} />}
        <button className="btn btn-big settings-close" onClick={onClose}>CLOSE</button>
      </div>
    </Dialog>
  )
}

const SignedOut = ({ localFurthest, onSignedIn }: { localFurthest: number; onSignedIn: (a: Account) => void }) => {
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (!USERNAME_PATTERN.test(username)) {
        setError('Username: 3 to 20 letters, digits, _ or -.')
        return
      }
      if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
        setError(`Password: ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`)
        return
      }
      if (password !== confirm) {
        setError('The two passwords don\'t match.')
        return
      }
    }
    setBusy(true)
    try {
      const account = mode === 'register'
        ? await register(username, password, localFurthest)
        : await login(username, password, localFurthest)
      setPassword('')
      setConfirm('')
      onSignedIn(account)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <div className="account-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'signin'}
          className={`btn btn-inline ${mode === 'signin' ? 'btn-toggled' : ''}`}
          onClick={() => { setMode('signin'); setError('') }}>SIGN IN</button>
        <button type="button" role="tab" aria-selected={mode === 'register'}
          className={`btn btn-inline ${mode === 'register' ? 'btn-toggled' : ''}`}
          onClick={() => { setMode('register'); setError('') }}>CREATE ACCOUNT</button>
      </div>
      <p className="account-note">
        Optional. An account puts your scores on the leaderboard, saves your run and tracks achievements.
        {mode === 'register' && ' There is no email, so a forgotten password can\'t be recovered.'}
      </p>
      <label className="account-field">
        <span>Username</span>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
          autoComplete="username" maxLength={20} required />
      </label>
      <label className="account-field">
        <span>Password</span>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={MAX_PASSWORD} required />
      </label>
      {mode === 'register' && (
        <label className="account-field">
          <span>Password again</span>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password" maxLength={MAX_PASSWORD} required />
        </label>
      )}
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'WORKING…' : mode === 'register' ? 'CREATE ACCOUNT ▸' : 'SIGN IN ▸'}
      </button>
    </form>
  )
}

const SignedIn = ({ account, onSignedOut }: { account: Account; onSignedOut: () => void }) => {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [deletePw, setDeletePw] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account-form">
      <p className="account-signed-in">
        Signed in as <strong>{account.username}</strong>
      </p>
      <button className="btn" disabled={busy} onClick={() => run(async () => { await logout(); onSignedOut() })}>
        SIGN OUT
      </button>

      <form className="account-section" onSubmit={e => {
        e.preventDefault()
        if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) {
          setError(`New password: ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`)
          return
        }
        run(async () => {
          await changePassword(current, next)
          setCurrent('')
          setNext('')
          setNotice('Password changed. Other devices were signed out.')
        })
      }}>
        <div className="account-section-title">CHANGE PASSWORD</div>
        <label className="account-field">
          <span>Current password</span>
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password" maxLength={MAX_PASSWORD} required />
        </label>
        <label className="account-field">
          <span>New password</span>
          <input type="password" value={next} onChange={e => setNext(e.target.value)}
            autoComplete="new-password" maxLength={MAX_PASSWORD} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>CHANGE PASSWORD</button>
      </form>

      <form className="account-section" onSubmit={e => {
        e.preventDefault()
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        run(async () => { await deleteAccount(deletePw); onSignedOut() })
      }}>
        <div className="account-section-title danger">DELETE ACCOUNT</div>
        <p className="account-note">Removes the account, its saved run and achievements, and its leaderboard entries. This can&apos;t be undone.</p>
        <label className="account-field">
          <span>Password</span>
          <input type="password" value={deletePw} onChange={e => setDeletePw(e.target.value)}
            autoComplete="current-password" maxLength={MAX_PASSWORD} required />
        </label>
        <button className="btn btn-danger" type="submit" disabled={busy}>
          {confirmDelete ? 'YES, DELETE IT FOREVER' : 'DELETE ACCOUNT'}
        </button>
      </form>

      {error && <p className="account-error" role="alert">{error}</p>}
      {notice && <p className="account-notice" role="status">{notice}</p>}
    </div>
  )
}

export default AccountDialog
