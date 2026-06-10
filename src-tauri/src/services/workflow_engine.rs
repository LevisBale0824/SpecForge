use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepName {
    Explore,
    Propose,
    Apply,
    Archive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepPhase {
    Idle,
    Input,
    Executing,
    Reviewing,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowState {
    pub current_step: StepName,
    pub current_phase: StepPhase,
}

impl Default for WorkflowState {
    fn default() -> Self {
        Self {
            current_step: StepName::Explore,
            current_phase: StepPhase::Idle,
        }
    }
}

static STEP_ORDER: &[StepName] = &[
    StepName::Explore,
    StepName::Propose,
    StepName::Apply,
    StepName::Archive,
];

pub struct WorkflowEngine {
    state: Mutex<WorkflowState>,
}

impl WorkflowEngine {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(WorkflowState::default()),
        }
    }

    pub fn state(&self) -> WorkflowState {
        self.state.lock().unwrap().clone()
    }

    pub fn set_phase(&self, phase: StepPhase) {
        self.state.lock().unwrap().current_phase = phase;
    }

    pub fn advance_step(&self) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        let current_idx = STEP_ORDER
            .iter()
            .position(|s| *s == state.current_step)
            .unwrap();
        if current_idx + 1 >= STEP_ORDER.len() {
            return Err("Already at the last step (Archive)".into());
        }
        state.current_step = STEP_ORDER[current_idx + 1];
        state.current_phase = StepPhase::Idle;
        Ok(())
    }

    pub fn reset(&self) {
        *self.state.lock().unwrap() = WorkflowState::default();
    }
}
