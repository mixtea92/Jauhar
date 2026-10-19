
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [message, setMessage] = useState('Connecting to Supabase...')
  const [error, setError] = useState(null)

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from('jauhar_test')
        .select('message')
        .eq('id', 1)
        .single()

      if (error) {
        setError(error.message)
        return
      }

      setMessage(data.message)
    }

    testConnection()
  }, [])

  return (
    <div style={{
      textAlign: 'center',
      padding: '80px 20px',
      fontFamily: 'Arial'
    }}>
      <h1>JAUHAR</h1>
      <h2>Internal Management System</h2>

      {error ? (
        <p style={{ color: 'red' }}>
          Connection failed: {error}
        </p>
      ) : (
        <p style={{ color: 'green' }}>
          {message}
        </p>
      )}
    </div>
  )
}

export default App
