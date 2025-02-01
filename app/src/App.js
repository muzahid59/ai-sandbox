import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { setOnNewMessage, listenMessage } from './fetch_message'; 
import ModelSelector from './components/ModelSelector';
import './App.css';
import Chat from './components/Chat';

function App() {
  return (
    <div className='App'>
      <Chat />
    </div>
  );
}

export default App;
