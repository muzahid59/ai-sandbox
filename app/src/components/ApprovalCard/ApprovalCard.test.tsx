import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalCard from './ApprovalCard';
import type { PendingAction } from '../../types';

jest.mock('../../api', () => ({
  getAction: jest.fn(),
}));

function makePendingAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 'pa-1',
    threadId: 'thread-1',
    userId: 'user-1',
    messageId: 'msg-1',
    toolName: 'test_approval',
    arguments: { message: 'hello world' },
    status: 'pending',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ApprovalCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the tool name formatted as human-readable', () => {
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={jest.fn()} isLoading={false} />,
    );
    expect(screen.getByText('Test approval')).toBeInTheDocument();
  });

  it('renders arguments as key-value pairs', () => {
    render(
      <ApprovalCard
        pendingAction={makePendingAction({ arguments: { recipient: 'alice', subject: 'Hi' } })}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Recipient:')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Subject:')).toBeInTheDocument();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('shows Approve and Reject buttons when status is pending', () => {
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={jest.fn()} isLoading={false} />,
    );
    expect(screen.getByRole('button', { name: /approve action/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject action/i })).toBeInTheDocument();
  });

  it.each(['approved', 'rejected', 'expired'] as const)(
    'hides buttons when status is %s',
    (status) => {
      render(
        <ApprovalCard
          pendingAction={makePendingAction({ status })}
          onApprove={jest.fn()}
          onReject={jest.fn()}
          isLoading={false}
        />,
      );
      expect(screen.queryByRole('button', { name: /approve action/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject action/i })).not.toBeInTheDocument();
    },
  );

  it.each([
    ['pending', 'Pending'],
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['expired', 'Expired'],
  ] as const)('shows status badge "%s" as "%s"', (status, label) => {
    render(
      <ApprovalCard
        pendingAction={makePendingAction({ status })}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        isLoading={false}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('disables buttons when isLoading is true', () => {
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={jest.fn()} isLoading={true} />,
    );
    expect(screen.getByRole('button', { name: /approve action/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject action/i })).toBeDisabled();
  });

  it('has ARIA labels on buttons', () => {
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={jest.fn()} isLoading={false} />,
    );
    expect(screen.getByLabelText('Approve action')).toBeInTheDocument();
    expect(screen.getByLabelText('Reject action')).toBeInTheDocument();
  });

  it('has ARIA label on card region', () => {
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={jest.fn()} isLoading={false} />,
    );
    expect(screen.getByRole('region', { name: /action approval required/i })).toBeInTheDocument();
  });

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = jest.fn();
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={onApprove} onReject={jest.fn()} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onReject when Reject button is clicked', () => {
    const onReject = jest.fn();
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={jest.fn()} onReject={onReject} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reject action/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('does not call handlers when buttons are disabled', () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();
    render(
      <ApprovalCard pendingAction={makePendingAction()} onApprove={onApprove} onReject={onReject} isLoading={true} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));
    fireEvent.click(screen.getByRole('button', { name: /reject action/i }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});
