import React, { useState } from 'react';
import './App.css';

function App() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const response = await fetch('http://localhost:3000/text-completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: inputValue }),
    });
    const completion = await response.text();
    setMessages([...messages, completion]);
    setInputValue('');
  };

  return (
    <div className="App">
      <div className="chatbox">
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default App;
