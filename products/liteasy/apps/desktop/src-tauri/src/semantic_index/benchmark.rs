use super::*;
/// Explicit benchmark; run the compiled release test executable and measure its peak RSS externally.
#[test]
#[ignore = "50k x 768 benchmark; run explicitly on the documented target machine"]
fn warm_fifty_thousand_vectors() {
    let path = std::env::temp_dir().join(format!(
        "liteasy-retrieval-bench-{}.sqlite3",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let mut db = open_db(&path).unwrap();
    {
        let tx = db.transaction().unwrap();
        for i in 0..50000 {
            let vector: Vec<f32> = (0..768)
                .map(|d| ((i * 31 + d * 17) % 997) as f32 / 997.)
                .collect();
            tx.execute("INSERT INTO entries(id,path,revision,text,vector,dimension,payload,updated) VALUES(?1,?2,'1','database transaction memory',?3,768,NULL,1)",params![format!("fragment-{i}"),format!("asset-{}",i/5),vector_bytes(&vector).unwrap()]).unwrap();
            tx.execute(
                "INSERT INTO words(rowid,tokens) VALUES(?1,'database transaction memory')",
                [tx.last_insert_rowid()],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let mut timings = Vec::new();
    for i in 0..35 {
        let start = std::time::Instant::now();
        let request = IndexRequest {
            scope: "local".into(),
            workspace: "bench".into(),
            model: "fixed-768".into(),
            action: "search".into(),
            records: vec![],
            ids: vec![],
            text: "transaction memory".into(),
            vector: Some(
                (0..768)
                    .map(|d| ((i * 31 + d * 17) % 997) as f32 / 997.)
                    .collect(),
            ),
            limit: Some(200),
            clauses: vec![],
            group: None,
            offset: None,
        };
        let result = execute(&mut db, request).unwrap();
        assert!(!result.as_array().unwrap().is_empty());
        if i >= 5 {
            timings.push(start.elapsed().as_secs_f64() * 1000.);
        }
    }
    timings.sort_by(f64::total_cmp);
    println!(
        "\n{}",
        json!({"assets":10000,"fragments":50000,"dimensions":768,"samples":timings.len(),"warmP95Ms":timings[28],"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"memoryMeasurement":"measure the test executable process externally; compiler memory is excluded"})
    );
    drop(db);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
}

#[test]
#[ignore = "explicit fixed-corpus lexical benchmark; no user data"]
fn lexical_small_medium_large() {
    for count in [500, 5000, 20000] {
        let path = std::env::temp_dir().join(format!(
            "liteasy-lexical-{}-{count}.sqlite3",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut db = open_db(&path).unwrap();
        let started = std::time::Instant::now();
        for start in (0..count).step_by(32) {
            let records = (start..(start + 32).min(count))
                .map(|i| IndexRecord {
                    id: format!("chunk-{i:06}"),
                    path: format!("asset-{:06}", i / 5),
                    revision: "1".into(),
                    text: format!(
                        "Synthetic document {i}\n{}\n{}",
                        "Research evidence and reproducible methods. ".repeat(40),
                        if i % 20 == 0 {
                            "研究 episodic memory"
                        } else {
                            "control record"
                        }
                    ),
                    tokens: "".into(),
                    vector: None,
                    payload: Some(json!({"group":"body"})),
                })
                .collect();
            execute(
                &mut db,
                IndexRequest {
                    scope: "local".into(),
                    workspace: "bench".into(),
                    model: "literal".into(),
                    action: "upsert".into(),
                    records,
                    ids: vec![],
                    text: String::new(),
                    vector: None,
                    limit: None,
                    clauses: vec![],
                    group: None,
                    offset: None,
                },
            )
            .unwrap();
        }
        let indexing_ms = started.elapsed().as_secs_f64() * 1000.;
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        let bytes = std::fs::metadata(&path).unwrap().len();
        let query = || IndexRequest {
            scope: "local".into(),
            workspace: "bench".into(),
            model: "literal".into(),
            action: "literal_query".into(),
            records: vec![],
            ids: vec![],
            text: String::new(),
            vector: None,
            limit: Some(20),
            clauses: vec!["研究".into(), "episodic memory".into()],
            group: Some("body".into()),
            offset: None,
        };
        let mut cold = Vec::new();
        for _ in 0..20 {
            drop(db);
            db = open_db(&path).unwrap();
            let time = std::time::Instant::now();
            let page = execute(&mut db, query()).unwrap();
            assert_eq!(page["total"], count / 20);
            cold.push(time.elapsed().as_secs_f64() * 1000.);
        }
        let mut warm = Vec::new();
        for _ in 0..40 {
            let time = std::time::Instant::now();
            execute(&mut db, query()).unwrap();
            warm.push(time.elapsed().as_secs_f64() * 1000.);
        }
        cold.sort_by(f64::total_cmp);
        warm.sort_by(f64::total_cmp);
        println!(
            "LEXICAL_METRIC {}",
            json!({"chunks":count,"documents":count/5,"indexingMs":indexing_ms,"sqliteBytes":bytes,"coldSamples":20,"warmSamples":40,"coldP50Ms":cold[9],"coldP95Ms":cold[18],"warmP50Ms":warm[19],"warmP95Ms":warm[37],"coldDefinition":"reopened SQLite connection; OS page cache not purged","os":std::env::consts::OS,"arch":std::env::consts::ARCH,"debugBuild":cfg!(debug_assertions)})
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
