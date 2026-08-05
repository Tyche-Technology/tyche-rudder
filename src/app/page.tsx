import { redirect } from 'next/navigation'

// The app has no dashboard of its own — Inbox is the default landing view.
export default function Home() {
  redirect('/inbox')
}
