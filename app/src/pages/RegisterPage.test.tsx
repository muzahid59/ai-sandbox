import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterPage } from './RegisterPage';
import * as authService from '../services/authService';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

jest.mock('../services/authService', () => ({
  ...jest.requireActual('../services/authService'),
  register: jest.fn(),
}));

const mockRegister = authService.register as jest.MockedFunction<typeof authService.register>;

function renderRegisterPage(onLogin = jest.fn()) {
  return render(<RegisterPage onLogin={onLogin} />);
}

describe('RegisterPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders email and password inputs', () => {
    renderRegisterPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('submit button is disabled while form is submitting', async () => {
    let resolveRegister: (value: any) => void;
    mockRegister.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveRegister = res;
        })
    );

    renderRegisterPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@user.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
    });

    resolveRegister!({ id: 'u-1', email: 'new@user.com' });
  });

  it('shows error message from authService on failure', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Email already registered'));

    renderRegisterPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dup@user.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/email already registered/i)).toBeInTheDocument();
    });
  });

  it('calls onLogin prop with user on success', async () => {
    const onLogin = jest.fn();
    mockRegister.mockResolvedValueOnce({ id: 'u-2', email: 'new@user.com' });

    renderRegisterPage(onLogin);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@user.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ id: 'u-2', email: 'new@user.com' });
    });
  });

  it('shows client-side validation error for short password', async () => {
    renderRegisterPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
