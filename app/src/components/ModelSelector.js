import React from 'react';

const ModelSelector = ({ selectedModel, onModelChange }) => {
  const models = [
    { id: 'openai', name: 'OpenAI GPT' },
    { id: 'google', name: 'Google Gemini' },
    { id: 'lama', name: 'Llama 3.2' },
    { id: 'deepseek', name: 'DeepSeek-r1' },
  ];

  return (
    <div style={{ position: 'absolute', top: '1rem', left: '1rem' }}>
      <select
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        style={{
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
          backgroundColor: '#fff',
          fontSize: '1rem',
        }}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ModelSelector;
