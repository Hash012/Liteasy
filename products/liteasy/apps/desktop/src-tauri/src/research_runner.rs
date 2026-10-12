//! Bounded CPU trace replay. This is a simulator, never a GPU-training benchmark.
//! Candidate code receives only past accesses; the immutable validator is host-owned.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

pub const VALIDATOR_VERSION: &str = "liteasy.trace-validator/v1";
pub fn code_digest() -> String {
    format!("{:x}", Sha256::digest(include_bytes!("research_runner.rs")))
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Candidate {
    Sequential,
    LastDelta,
    Oracle,
    OmitSamples,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaySpec {
    pub candidate: Candidate,
    pub cache_bytes: u64,
    pub sample_bytes: u64,
    pub io_us: u64,
    pub compute_us: u64,
    pub samples: usize,
    pub train_seed: u32,
    pub holdout_seed: u32,
    pub validator_version: String,
    pub code_snapshot: String,
}
impl ReplaySpec {
    pub fn validate(&self) -> Result<(), String> {
        if matches!(self.candidate, Candidate::Oracle | Candidate::OmitSamples) {
            return Err(
                "candidate_not_deployable: oracle/omitted samples cannot enter a fair comparison"
                    .into(),
            );
        }
        if self.samples < 16
            || self.samples > 20_000
            || self.sample_bytes == 0
            || self.sample_bytes > 1024 * 1024
            || self.cache_bytes < self.sample_bytes
            || self.cache_bytes > 64 * 1024 * 1024
            || self.io_us == 0
            || self.io_us > 1_000_000
            || self.compute_us > 1_000_000
            || self.train_seed == self.holdout_seed
            || self.validator_version != VALIDATOR_VERSION
            || self.code_snapshot != code_digest()
        {
            return Err(
                "invalid_spec: bounds, independent holdout or protected validator mismatch".into(),
            );
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMetrics {
    pub simulated_wait_p50_us: u64,
    pub simulated_wait_p95_us: u64,
    pub simulated_wait_total_us: u64,
    pub simulated_elapsed_us: u64,
    pub simulated_samples_per_second: f64,
    pub read_amplification: f64,
    pub io_read_bytes: u64,
    pub cache_peak_bytes: u64,
    pub replay_wall_us: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayOutput {
    pub workload: String,
    pub algorithm: String,
    pub metrics: ReplayMetrics,
    pub delivered: Vec<String>,
    pub correctness: bool,
    pub trace_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayResult {
    pub validator_version: String,
    pub code_snapshot: String,
    pub trace: Vec<String>,
    pub holdout_trace: Vec<String>,
    pub negative_trace: Vec<String>,
    pub outputs: Vec<ReplayOutput>,
    pub correctness_passed: bool,
    pub conditional_status: String,
    pub conditions: Vec<String>,
}
pub fn trace(samples: usize, seed: u32, heldout: bool) -> Vec<String> {
    (0..samples)
        .map(|i| {
            let index = if heldout {
                (i * (3 + (seed as usize % 15) * 2) + seed as usize) % 128
            } else {
                (i + seed as usize % 128) % 128
            };
            format!("sample-{index:03}:image+label")
        })
        .collect()
}
pub fn negative_trace(samples: usize, seed: u32) -> Vec<String> {
    let mut state = seed ^ 0xa5a5_5a5a;
    (0..samples)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            format!("sample-{:03}:image+label", (state >> 16) % 128)
        })
        .collect()
}
fn digest_trace(trace: &[String]) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(trace).unwrap()))
}
pub fn validate_delivery(expected: &[String], actual: &[String]) -> bool {
    // Order, multiplicity and the image+label identity must all match.
    !expected.is_empty() && expected == actual
}
#[derive(Clone)]
struct CacheEntry {
    ready: u64,
    used: u64,
}
fn replay(
    spec: &ReplaySpec,
    requests: &[String],
    candidate: Option<&Candidate>,
    workload: &str,
    cancelled: &AtomicBool,
    authorized: &impl Fn() -> bool,
    deadline_start: Instant,
) -> Result<ReplayOutput, String> {
    let start = Instant::now();
    let capacity = (spec.cache_bytes / spec.sample_bytes) as usize;
    let mut cache: BTreeMap<String, CacheEntry> = BTreeMap::new();
    let (mut clock, mut io_end, mut reads, mut peak) = (0u64, 0u64, 0u64, 0usize);
    let mut waits = Vec::new();
    let mut delivered = Vec::new();
    let mut past: VecDeque<i64> = VecDeque::new();
    for (i, request) in requests.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if !authorized() {
            return Err("permission_revoked".into());
        }
        if deadline_start.elapsed().as_secs() >= 10 {
            return Err("exhausted".into());
        }
        let ready = match cache.get(request) {
            Some(entry) => entry.ready,
            None => {
                if cache.len() >= capacity {
                    let victim = cache
                        .iter()
                        .min_by_key(|(_, value)| value.used)
                        .map(|(key, _)| key.clone())
                        .unwrap();
                    cache.remove(&victim);
                }
                io_end = io_end.max(clock) + spec.io_us;
                reads += spec.sample_bytes;
                cache.insert(
                    request.clone(),
                    CacheEntry {
                        ready: io_end,
                        used: i as u64 * 2,
                    },
                );
                io_end
            }
        };
        let wait = ready.saturating_sub(clock);
        waits.push(wait);
        clock = clock.max(ready);
        cache.get_mut(request).unwrap().used = i as u64 * 2 + 1;
        delivered.push(request.clone());
        let current: i64 = request
            .split(['-', ':'])
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(-1);
        let next = match candidate {
            Some(Candidate::Sequential) => Some((current + 1) % 128),
            Some(Candidate::LastDelta) => {
                past.back().map(|last| (2 * current - last).rem_euclid(128))
            }
            _ => None,
        };
        past.push_back(current);
        if past.len() > 2 {
            past.pop_front();
        }
        if let Some(next) = next {
            let id = format!("sample-{next:03}:image+label");
            if !cache.contains_key(&id) && cache.len() < capacity {
                io_end = io_end.max(clock) + spec.io_us;
                reads += spec.sample_bytes;
                cache.insert(
                    id,
                    CacheEntry {
                        ready: io_end,
                        used: i as u64 * 2,
                    },
                );
            } else if !cache.contains_key(&id) && capacity > 1 {
                // Evict an old completed cache entry, never the current sample or a pending read.
                let victim = cache
                    .iter()
                    .filter(|(key, value)| *key != request && value.ready <= clock)
                    .min_by_key(|(_, value)| value.used)
                    .map(|(key, _)| key.clone());
                if let Some(victim) = victim {
                    cache.remove(&victim);
                    io_end = io_end.max(clock) + spec.io_us;
                    reads += spec.sample_bytes;
                    cache.insert(
                        id,
                        CacheEntry {
                            ready: io_end,
                            used: i as u64 * 2,
                        },
                    );
                }
            }
        }
        peak = peak.max(cache.len());
        clock += spec.compute_us;
    }
    let correctness = validate_delivery(requests, &delivered);
    let total_wait = waits.iter().sum();
    waits.sort_unstable();
    Ok(ReplayOutput {
        workload: workload.into(),
        algorithm: match candidate {
            None => "lru",
            Some(Candidate::Sequential) => "sequential",
            Some(Candidate::LastDelta) => "last_delta",
            _ => "rejected",
        }
        .into(),
        metrics: ReplayMetrics {
            simulated_wait_p50_us: waits[(waits.len() - 1) / 2],
            simulated_wait_p95_us: waits[((waits.len() - 1) * 95) / 100],
            simulated_wait_total_us: total_wait,
            simulated_elapsed_us: clock,
            simulated_samples_per_second: requests.len() as f64 * 1_000_000.0 / clock.max(1) as f64,
            read_amplification: reads as f64 / (requests.len() as u64 * spec.sample_bytes) as f64,
            io_read_bytes: reads,
            cache_peak_bytes: peak as u64 * spec.sample_bytes,
            replay_wall_us: start.elapsed().as_micros() as u64,
        },
        delivered,
        correctness,
        trace_sha256: digest_trace(requests),
    })
}
pub fn run(
    spec: &ReplaySpec,
    cancelled: &AtomicBool,
    authorized: impl Fn() -> bool,
) -> Result<ReplayResult, String> {
    spec.validate()?;
    let deadline_start = Instant::now();
    let training = trace(spec.samples, spec.train_seed, false);
    let heldout = trace(spec.samples, spec.holdout_seed, true);
    let negative = negative_trace(spec.samples, spec.holdout_seed);
    let mut outputs = Vec::new();
    for (name, data) in [
        ("sequential_training", &training),
        ("heldout_strided", &heldout),
        ("negative_unpredictable", &negative),
    ] {
        outputs.push(replay(
            spec,
            data,
            None,
            name,
            cancelled,
            &authorized,
            deadline_start,
        )?);
        outputs.push(replay(
            spec,
            data,
            Some(&spec.candidate),
            name,
            cancelled,
            &authorized,
            deadline_start,
        )?);
    }
    // Ablate the proposed mechanism: without computation there is no useful
    // overlap window. This is a separate workload, not a different baseline budget.
    let mut ablated = spec.clone();
    ablated.compute_us = 0;
    outputs.push(replay(
        &ablated,
        &training,
        None,
        "ablation_no_overlap",
        cancelled,
        &authorized,
        deadline_start,
    )?);
    outputs.push(replay(
        &ablated,
        &training,
        Some(&spec.candidate),
        "ablation_no_overlap",
        cancelled,
        &authorized,
        deadline_start,
    )?);
    let correctness = outputs
        .iter()
        .all(|r| r.correctness && r.metrics.cache_peak_bytes <= spec.cache_bytes);
    let improved = correctness
        && outputs[1].metrics.simulated_wait_total_us < outputs[0].metrics.simulated_wait_total_us;
    let heldout_improved = correctness
        && outputs[3].metrics.simulated_wait_total_us < outputs[2].metrics.simulated_wait_total_us;
    Ok(ReplayResult {
        validator_version: VALIDATOR_VERSION.into(), code_snapshot: code_digest(),
        trace: training, holdout_trace: heldout, negative_trace: negative, outputs, correctness_passed: correctness,
        conditional_status: if !correctness { "refuted" } else if improved { "supported_under_conditions" } else { "inconclusive" }.into(),
        conditions: vec![
            "Synthetic CPU trace replay only; no claim of GPU training speedup or novelty.".into(),
            "Equal cache-byte budget and one serial I/O device; metadata IDs known, future requests hidden.".into(),
            if heldout_improved { "Held-out randomized-stride trace also improved in this simulation." } else { "The improvement does not generalize to the held-out strided trace; keep the narrower condition." }.into(),
            "Unpredictable-access negative control and no-computation-overlap ablation are reported separately; they do not establish general workload improvement.".into(),
        ],
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub fn spec() -> ReplaySpec {
        ReplaySpec {
            candidate: Candidate::Sequential,
            cache_bytes: 32768,
            sample_bytes: 4096,
            io_us: 2000,
            compute_us: 3000,
            samples: 256,
            train_seed: 11,
            holdout_seed: 37,
            validator_version: VALIDATOR_VERSION.into(),
            code_snapshot: code_digest(),
        }
    }
    #[test]
    fn real_replay_preserves_samples_and_shrinks_the_claim_after_holdout() {
        let spec = spec();
        let result = run(&spec, &AtomicBool::new(false), || true).unwrap();
        assert!(result.correctness_passed);
        assert_eq!(result.conditional_status, "supported_under_conditions");
        assert!(
            result.outputs[1].metrics.simulated_wait_total_us
                < result.outputs[0].metrics.simulated_wait_total_us
        );
        assert!(result.conditions.iter().any(|s| s.contains("narrower")));
        assert!(result
            .outputs
            .iter()
            .all(|r| r.metrics.cache_peak_bytes <= spec.cache_bytes));
    }
    #[test]
    fn correctness_cannot_be_traded_for_speed_or_future_knowledge() {
        assert!(!validate_delivery(
            &["image+label".into(), "second".into()],
            &["image+label".into()]
        ));
        assert!(!validate_delivery(
            &["image+label".into()],
            &["label+image".into()]
        ));
        let mut s = spec();
        s.candidate = Candidate::Oracle;
        assert!(s.validate().is_err());
        s.candidate = Candidate::OmitSamples;
        assert!(s.validate().is_err());
        s.candidate = Candidate::Sequential;
        s.code_snapshot = "agent-modified-validator".into();
        assert!(s.validate().is_err());
    }
    #[test]
    fn cancellation_and_authority_revocation_are_not_completion() {
        assert_eq!(
            run(&spec(), &AtomicBool::new(true), || true).unwrap_err(),
            "cancelled"
        );
        assert_eq!(
            run(&spec(), &AtomicBool::new(false), || false).unwrap_err(),
            "permission_revoked"
        );
    }
    #[test]
    fn negative_control_and_overlap_ablation_are_real_executions_with_equal_constraints() {
        let result = run(&spec(), &AtomicBool::new(false), || true).unwrap();
        assert_eq!(result.outputs.len(), 8);
        assert!(result.outputs.iter().all(|output| output.correctness));
        assert_eq!(
            result.outputs[4].trace_sha256,
            result.outputs[5].trace_sha256
        );
        assert_ne!(
            result.outputs[0].trace_sha256,
            result.outputs[4].trace_sha256
        );
        assert!(
            result.outputs[7].metrics.simulated_wait_total_us
                >= result.outputs[6].metrics.simulated_wait_total_us
        );
        assert_eq!(result.negative_trace, negative_trace(256, 37));
    }
}
