CREATE TABLE direct_conversation_reads (
  conversation_id text NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  last_read_message_id text NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX direct_conversation_reads_user_idx
  ON direct_conversation_reads(user_id, conversation_id);
