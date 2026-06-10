use openspec_workbench_lib::services::workflow_engine::*;

#[test]
fn test_initial_state() {
    let engine = WorkflowEngine::new();
    let state = engine.state();
    assert_eq!(state.current_step, StepName::Explore);
    assert_eq!(state.current_phase, StepPhase::Idle);
}

#[test]
fn test_advance_step() {
    let engine = WorkflowEngine::new();
    engine.advance_step().unwrap();
    assert_eq!(engine.state().current_step, StepName::Propose);
}

#[test]
fn test_set_phase() {
    let engine = WorkflowEngine::new();
    engine.set_phase(StepPhase::Input);
    assert_eq!(engine.state().current_phase, StepPhase::Input);
}

#[test]
fn test_full_lifecycle() {
    let engine = WorkflowEngine::new();
    // Explore
    engine.set_phase(StepPhase::Input);
    engine.set_phase(StepPhase::Executing);
    engine.set_phase(StepPhase::Reviewing);
    engine.set_phase(StepPhase::Done);
    engine.advance_step().unwrap();
    assert_eq!(engine.state().current_step, StepName::Propose);
    // Propose
    engine.set_phase(StepPhase::Input);
    engine.set_phase(StepPhase::Done);
    engine.advance_step().unwrap();
    assert_eq!(engine.state().current_step, StepName::Apply);
    // Apply
    engine.set_phase(StepPhase::Input);
    engine.set_phase(StepPhase::Done);
    engine.advance_step().unwrap();
    assert_eq!(engine.state().current_step, StepName::Archive);
    // Archive
    engine.set_phase(StepPhase::Input);
    engine.set_phase(StepPhase::Done);
    assert!(engine.advance_step().is_err());
}

#[test]
fn test_reset() {
    let engine = WorkflowEngine::new();
    engine.set_phase(StepPhase::Executing);
    engine.advance_step().unwrap();
    engine.reset();
    assert_eq!(engine.state().current_step, StepName::Explore);
    assert_eq!(engine.state().current_phase, StepPhase::Idle);
}
