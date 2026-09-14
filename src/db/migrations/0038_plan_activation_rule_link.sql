ALTER TABLE plan_activations ADD COLUMN rule_id uuid REFERENCES point_rules(id);
