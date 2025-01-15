import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchMessage, setOnNewMessage, listenMessage } from './fetch_message'; 
import './App.css';

function App() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [imageData, setImageData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognition = useRef(null);
  const fileInputRef = useRef();
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
    dispatchMessage({ text: inputValue, image: imageData, sent: true});
  };

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageData(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  async function dispatchMessage(message) {
    console.log('dispatchMessage', message);
    try {
      setIsLoading(true);
      const newMessaages = [...messagesRef.current, message];
      setMessages(newMessaages);
      setInputValue('');
      listenMessage(message);
      setImageData(null);
      fileInputRef.current.value = '';
    } catch (error) {
      console.error('Error:', error);
      setIsLoading(false);
    }
  } 

  return (
    <div className="App">
      <div className="chatbox">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.sent ? 'sent' : 'received'}`}>
            <ReactMarkdown>{message.text}</ReactMarkdown>
          </div>
        ))}
        {/* {isLoading && <div className="loader"></div>} Add loader here */}
      </div>
      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={inputValue}
          placeholder= { isListening ? 'Listening...' : 'Type a message'}
          onChange={e => setInputValue(e.target.value)}
        />
         <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            style={{ display: 'none' }} // Hide the default input
          />
          <button 
            className={`attach-button ${imageData ? 'attached' : ''}`}
            type="button"
            onClick={() => fileInputRef.current.click()} // Trigger the hidden input
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
