import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { setOnNewMessage, listenMessage } from './fetch_message';
import ModelSelector from './components/ModelSelector';
import './App.css';
import ChatContainer from './components/ChatContainer/ChatContainer';

function App() {
  return (
    <div className="App">
      <ChatContainer />
    </div>
  );
}

export default App;
