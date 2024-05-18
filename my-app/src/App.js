import React, { useState } from 'react';
import { fetchMessage, setOnNewMessage, listenMessage } from './fetch_message'; 
import './App.css';

function App() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!inputValue) {
      return;
    }

    try {
      setIsLoading(true);
      const newMessaages = [...messages, inputValue];
      setMessages(newMessaages);
      setInputValue('');
      listenMessage(inputValue);
      // const response = await fetchMessage(inputValue);
      // const completion = response;
      // setMessages([...newMessaages, completion]);
      // setIsLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setIsLoading(false);
    }
  };

  setOnNewMessage((message) => {
    const newMessaages = [...messages, message];
    setMessages(newMessaages);
    setIsLoading(false);
  })

  return (
    <div className="App">
      <div className="chatbox">
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
        {isLoading && <div className="loader"></div>} {/* Add loader here */}
      </div>
      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
        />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}

export default App;
