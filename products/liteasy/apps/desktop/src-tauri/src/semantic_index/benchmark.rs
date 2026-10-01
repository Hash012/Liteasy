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
