import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

function Signup({ onToggle }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { signup } = useAuth();

  const handleSubmit = (e) => {
    e.preventDefault();
    const result = signup(username, password);
    if (result.success) {
      setError('');
      onToggle(); // Switch back to login
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="auth-container">
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>Sign Up</h2>
        {error && <div className="error">{error}</div>}
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit">Sign Up</button>
        <p className="toggle-text">
          Already have an account?{' '}
          <button onClick={onToggle} className="toggle-button">
            Login
          </button>
        </p>
      </form>
    </div>
  );
}

export default Signup;
