import React, { useState, useEffect, useRef } from 'react';
import { fetchMessage, setOnNewMessage, listenMessage } from './fetch_message'; 
import './App.css';

function App() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognition = useRef(null);
  const messagesRef = useRef(messages);

  setOnNewMessage((message) => {
    const newMessaages = [...messages, message];
    setMessages(newMessaages);
    setIsLoading(false);
  })

  useEffect(() => {
      recognition.current = new (window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition)();
      let finalTranscript = '';
      if (recognition.current) {
        console.log('Speech recognition supported');
        recognition.lang = 'en-US';
        recognition.current.interimResults = true;
        recognition.current.continuous = true;
        recognition.current.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');

          console.log('recognition result', transcript);
          finalTranscript = transcript
          setInputValue(transcript);
        };

        recognition.current.onend = () => {
          console.log('recognition end');
          console.log('inputValue', finalTranscript);
          dispatchMessage(finalTranscript);
          setIsListening(false);
        };
      } else {
        console.log('Speech recognition not supported');
      }
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);


   const startListening = () => {
    console.log('start listening');
    setIsListening(true);
    if (recognition.current) {
      console.log('start listening');
      recognition.current.start();
    }
  };

  const stopListening = () => {
    setIsListening(false);
    console.log('stop listening');
    if (recognition.current) {
      console.log('stop listening');
      recognition.current.stop();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!inputValue) {
      return;
    }
    dispatchMessage(inputValue);
  };

  async function dispatchMessage(message) {
    try {
      setIsLoading(true);
      const newMessaages = [...messagesRef.current, message];
      setMessages(newMessaages);
      setInputValue('');
      listenMessage(message);
    } catch (error) {
      console.error('Error:', error);
      setIsLoading(false);
    }
  } 

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
          placeholder= { isListening ? 'Listening...' : 'Type a message'}
          onChange={e => setInputValue(e.target.value)}
        />
        <button 
          className={`microphone-button ${isListening ? 'listening' : ''}`}
          type="button" 
          onClick={isListening ? stopListening : startListening}
        />
        <button type="submit" className='submit-button'  disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}

export default App;
